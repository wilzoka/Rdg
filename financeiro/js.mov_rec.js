$(function () {

    $('select[name="idpessoa"]').attr('data-where', 'cliente = true');
    $('select[name="idcategoria"]').attr('data-where', 'dc = 2');

    $(document).on('app-datatable', function (e, table) {

        $('button#' + table + '_insert').remove();

    });

});
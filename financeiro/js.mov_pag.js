$(function () {

    $('select[name="idpessoa"]').attr('data-where', 'fornecedor = true');
    $('select[name="idcategoria"]').attr('data-where', 'dc = 1');

    $(document).on('app-datatable', function (e, table) {

        $('button#' + table + '_insert').remove();

    });

});